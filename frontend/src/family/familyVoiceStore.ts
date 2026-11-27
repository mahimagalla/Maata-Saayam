export type FamilyVoice = { displayName: string; message: string; audio: Blob }

const databaseName = 'maata-saayam-family'
const storeName = 'voice'
const recordingKey = 'trusted-message'

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onblocked = () => {
      blocked = true
      reject(new Error('Recording storage is busy'))
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
  })
}

async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode)
      const request = operation(transaction.objectStore(storeName))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error('Recording storage canceled'))
    })
  } finally {
    database.close()
  }
}

export async function readFamilyVoice(): Promise<FamilyVoice | null> {
  const value: Partial<FamilyVoice> | undefined = await transact('readonly', (store) => store.get(recordingKey))
  if (!value) return null
  if (typeof value.displayName !== 'string' || !value.displayName.trim() ||
    typeof value.message !== 'string' || !value.message.trim() || !(value.audio instanceof Blob) || !value.audio.size) {
    throw new Error('Invalid family recording')
  }
  return { displayName: value.displayName, message: value.message, audio: value.audio }
}

export async function saveFamilyVoice(value: FamilyVoice) {
  if (!value.displayName.trim() || !value.message.trim() || !value.audio.size) throw new Error('Recording details are incomplete')
  await transact('readwrite', (store) => store.put(value, recordingKey))
}

export async function deleteFamilyVoice() {
  await transact('readwrite', (store) => store.delete(recordingKey))
}
