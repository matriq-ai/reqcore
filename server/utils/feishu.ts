import { env } from './env'

// ─────────────────────────────────────────────
// Feishu Drive utilities for document storage
// ─────────────────────────────────────────────

let _cachedToken: string | undefined
let _tokenExpireTime: number | undefined

/**
 * Get Feishu tenant access token with module-level caching.
 * Refreshes automatically when within 30 minutes of expiration.
 */
export async function getFeishuTenantAccessToken(): Promise<string> {
  const now = Date.now()
  if (_cachedToken && _tokenExpireTime && now < _tokenExpireTime - 30 * 60 * 1000) {
    return _cachedToken
  }

  const appId = env.AUTH_FEISHU_CLIENT_ID
  const appSecret = env.AUTH_FEISHU_CLIENT_SECRET

  if (!appId || !appSecret) {
    throw new Error('AUTH_FEISHU_CLIENT_ID and AUTH_FEISHU_CLIENT_SECRET are required for Feishu integration')
  }

  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })

  const data = await response.json() as { code: number; msg: string; tenant_access_token?: string; expire?: number }

  if (data.code !== 0) {
    throw new Error(`Failed to get Feishu tenant access token: code=${data.code}, msg=${data.msg}`)
  }

  _cachedToken = data.tenant_access_token!
  _tokenExpireTime = now + (data.expire! * 1000)

  return _cachedToken
}

/**
 * Upload a file to Feishu Drive.
 * @param buffer - File content as Buffer
 * @param fileName - Original filename
 * @param size - File size in bytes
 * @returns Feishu file_token
 */
export async function uploadToFeishuDrive(buffer: Buffer, fileName: string, size: number): Promise<string> {
  const folderToken = env.FEISHU_DRIVE_FOLDER_TOKEN

  if (!folderToken) {
    throw new Error('FEISHU_DRIVE_FOLDER_TOKEN is required for uploading files to Feishu Drive')
  }

  const token = await getFeishuTenantAccessToken()

  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2)
  const bodyParts: string[] = []

  bodyParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file_name"\r\n\r\n${fileName}`)
  bodyParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="parent_type"\r\n\r\nexplorer`)
  bodyParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="parent_node"\r\n\r\n${folderToken}`)
  bodyParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n${size}`)
  bodyParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`)

  const headerBuffer = Buffer.from(bodyParts.join('\r\n'), 'utf-8')
  const footerBuffer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8')
  const fileBuffer = buffer

  const fullBody = Buffer.concat([headerBuffer, fileBuffer, footerBuffer])

  const response = await fetch('https://open.feishu.cn/open-apis/drive/v1/files/upload_all', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: fullBody,
  })

  const data = await response.json() as { code: number; msg: string; data?: { file_token?: string } }

  if (data.code !== 0) {
    throw new Error(`Failed to upload to Feishu Drive: code=${data.code}, msg=${data.msg}`)
  }

  return data.data!.file_token!
}

/**
 * Download a file from Feishu Drive.
 * @param fileToken - Feishu file_token
 * @returns File content as Buffer
 */
export async function downloadFromFeishuDrive(fileToken: string): Promise<Buffer> {
  const token = await getFeishuTenantAccessToken()

  const response = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}/download`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  })

  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    const data = await response.json() as { code: number; msg: string }
    if (data.code !== 0) {
      throw new Error(`Failed to download from Feishu Drive: code=${data.code}, msg=${data.msg}`)
    }
    throw new Error('Feishu download returned empty response')
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Delete a file from Feishu Drive.
 * @param fileToken - Feishu file_token to delete
 */
export async function deleteFromFeishuDrive(fileToken: string): Promise<void> {
  const token = await getFeishuTenantAccessToken()

  const response = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}?type=file`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  })

  const data = await response.json() as { code: number; msg: string }

  if (data.code !== 0) {
    throw new Error(`Failed to delete from Feishu Drive: code=${data.code}, msg=${data.msg}`)
  }
}
