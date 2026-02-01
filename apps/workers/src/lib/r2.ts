/**
 * R2 Storage Utilities
 *
 * Generic utilities for storing, retrieving, and managing documents in Cloudflare R2.
 * Provides metadata support for audit trails and document organization.
 */

/**
 * Document metadata for audit trail
 */
export interface DocumentMetadata {
  /** Source system (e.g., 'eCFR', 'Texas SOS') */
  source: string;
  /** Data type (e.g., 'raw-regulation', 'checkpoint', 'processed-chunk') */
  dataType: string;
  /** ISO timestamp when document was fetched from source */
  fetchedAt: string;
  /** Additional metadata fields */
  [key: string]: string;
}

/**
 * R2 document information from list operations
 */
export interface R2DocumentInfo {
  /** R2 object key (full path) */
  key: string;
  /** Size in bytes */
  size: number;
  /** Upload timestamp */
  uploaded: Date;
  /** Custom metadata (optional) */
  metadata?: Record<string, string>;
}

/**
 * Store a document in R2 with metadata
 *
 * @param bucket R2 bucket instance
 * @param key Document key (path)
 * @param content Document content (string or binary)
 * @param metadata Audit metadata to attach
 */
export async function storeDocument(
  bucket: R2Bucket,
  key: string,
  content: string | ArrayBuffer,
  metadata: DocumentMetadata
): Promise<void> {
  // Determine content type based on file extension
  const contentType = getContentType(key);

  // Convert content to proper format
  const body = typeof content === 'string' ? content : content;

  // Add standard metadata fields
  const fullMetadata: Record<string, string> = {
    ...metadata,
    storedAt: new Date().toISOString(),
    contentLength: String(
      typeof content === 'string' ? content.length : content.byteLength
    ),
  };

  // Store in R2 (R2 requires all metadata values to be strings)
  await bucket.put(key, body, {
    httpMetadata: {
      contentType,
    },
    customMetadata: fullMetadata,
  });
}

/**
 * Retrieve a document from R2 with its metadata
 *
 * @param bucket R2 bucket instance
 * @param key Document key (path)
 * @returns Document content and metadata, or null if not found
 */
export async function getDocument(
  bucket: R2Bucket,
  key: string
): Promise<{ content: string; metadata: Record<string, string> } | null> {
  const object = await bucket.get(key);

  if (!object) {
    return null;
  }

  const content = await object.text();
  const metadata = object.customMetadata || {};

  return { content, metadata };
}

/**
 * List documents under a prefix (folder structure)
 *
 * @param bucket R2 bucket instance
 * @param prefix Key prefix to filter by (folder path)
 * @param limit Maximum number of results (optional)
 * @returns Array of document information
 */
export async function listDocuments(
  bucket: R2Bucket,
  prefix: string,
  limit?: number
): Promise<R2DocumentInfo[]> {
  const listOptions: R2ListOptions = {
    prefix,
    limit,
  };

  const listed = await bucket.list(listOptions);

  return listed.objects.map((obj) => ({
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded,
    metadata: obj.customMetadata,
  }));
}

/**
 * Delete a document from R2
 *
 * @param bucket R2 bucket instance
 * @param key Document key (path)
 * @returns True if deleted, false if not found
 */
export async function deleteDocument(
  bucket: R2Bucket,
  key: string
): Promise<boolean> {
  const object = await bucket.get(key);

  if (!object) {
    return false;
  }

  await bucket.delete(key);
  return true;
}

/**
 * Determine content type based on file extension
 *
 * @param key File key/path
 * @returns MIME type
 */
function getContentType(key: string): string {
  if (key.endsWith('.xml')) {
    return 'application/xml';
  }
  if (key.endsWith('.json')) {
    return 'application/json';
  }
  if (key.endsWith('.txt')) {
    return 'text/plain';
  }
  if (key.endsWith('.html')) {
    return 'text/html';
  }
  return 'application/octet-stream';
}
