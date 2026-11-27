import { useEffect, useState } from 'react'

const permissionLabels = {
  granted: 'Granted',
  denied: 'Blocked',
  prompt: 'Permission may be requested',
}

export function useMicrophonePermission() {
  const [permission, setPermission] = useState('Not reported by this browser')

  useEffect(() => {
    if (!navigator.permissions?.query) return

    let active = true
    let status: PermissionStatus | undefined
    function update() {
      if (active && status) setPermission(permissionLabels[status.state])
    }

    void navigator.permissions.query({ name: 'microphone' }).then((result) => {
      if (!active) return
      status = result
      status.addEventListener('change', update)
      update()
    }).catch(() => {
      // The recognition service can still prompt for the microphone.
    })

    return () => {
      active = false
      status?.removeEventListener('change', update)
    }
  }, [])

  return permission
}
