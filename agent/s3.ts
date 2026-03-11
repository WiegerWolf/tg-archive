import * as Minio from 'minio';
import { createReadStream, existsSync } from 'fs';
import { basename } from 'path';
import { createHash } from 'crypto';
import { promisify } from 'util';
import { createReadStream as fsCreateReadStream } from 'fs';
import { pipeline } from 'stream';
import mime from 'mime-types';

const pipelineAsync = promisify(pipeline);

const {
  S3_ENDPOINT_HOST = 'minio',
  S3_ENDPOINT_PORT = 9000,
  S3_ACCESS_KEY = '',
  S3_SECRET_KEY = '',
  S3_BUCKET_NAME = 'tg-archive',
  S3_USE_SSL = false
} = process.env;

const minioClient = new Minio.Client({
  endPoint: S3_ENDPOINT_HOST,
  port: Number(S3_ENDPOINT_PORT),
  useSSL: S3_USE_SSL === 'true',
  accessKey: S3_ACCESS_KEY,
  secretKey: S3_SECRET_KEY
});

const FILE_TOO_LARGE_MARKER = "(File exceeds maximum size. Change data exporting settings to download.)";

async function verifyConnection() {
  try {
    await minioClient.listBuckets();
  } catch (error) {
    console.error('Failed to connect to MinIO:', error);
    throw error;
  }
}

async function ensureBucket() {
  try {
    const exists = await minioClient.bucketExists(S3_BUCKET_NAME);
    if (!exists) {
      await minioClient.makeBucket(S3_BUCKET_NAME);
      console.log(`Created bucket: ${S3_BUCKET_NAME}`);
    }
  } catch (error) {
    console.error('Error ensuring bucket exists:', error);
    throw error;
  }
}

async function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fsCreateReadStream(filePath);
    
    stream.on('error', err => reject(err));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function checkObjectExists(key: string): Promise<boolean> {
  try {
    await minioClient.statObject(S3_BUCKET_NAME, key);
    return true;
  } catch (error: any) {
    if (error.code === 'NotFound') {
      return false;
    }
    throw error;
  }
}

export async function uploadFile(filePath: string): Promise<string | null> {
  try {
    if (filePath.includes(FILE_TOO_LARGE_MARKER)) {
      console.warn(`File was too large to export: ${filePath}`);
      return null;
    }

    if (!existsSync(filePath)) {
      console.warn(`File does not exist: ${filePath}`);
      return null;
    }

    await verifyConnection();
    
    // Calculate hash based on file contents
    const hash = await calculateFileHash(filePath);
    const key = hash;

    // Check if file already exists
    const exists = await checkObjectExists(key);
    if (exists) {
      console.log(`File with hash ${key} already exists, skipping upload`);
      return key;
    }

    const fileName = basename(filePath);
    const metaData = {
      'Content-Type': getContentType(fileName),
      // Encode filename in base64 to handle non-ASCII characters
      'original-filename': Buffer.from(fileName).toString('base64')
    };

    console.log(`Uploading ${fileName} with key ${key}`);

    await minioClient.fPutObject(S3_BUCKET_NAME, key, filePath, metaData);
    
    return key;

  } catch (error) {
    console.error('Error uploading file:', error);
    console.error('MinIO Configuration:', {
      endpoint: S3_ENDPOINT_HOST,
      port: S3_ENDPOINT_PORT,
      bucket: S3_BUCKET_NAME,
      accessKeyId: S3_ACCESS_KEY?.substring(0, 4) + '...',
    });
    throw error;
  }
}

// If you need to retrieve the original filename later, you can decode it like this:
async function getOriginalFilename(key: string): Promise<string | null> {
  try {
    const stat = await minioClient.statObject(S3_BUCKET_NAME, key);
    const encodedFilename = stat.metaData['original-filename'];
    if (encodedFilename) {
      return Buffer.from(encodedFilename, 'base64').toString();
    }
    return null;
  } catch (error) {
    console.error('Error getting original filename:', error);
    return null;
  }
}

function getContentType(fileName: string): string {
  // Special case for Telegram stickers
  if (fileName.endsWith('.tgs')) {
    return 'application/x-tgsticker';
  }

  const mimeType = mime.lookup(fileName);
  
  // If mime-types package couldn't determine the type, fallback to octet-stream
  if (!mimeType) {
    console.warn(`Could not determine mime type for: ${fileName}`);
    return 'application/octet-stream';
  }

  return mimeType;
}

export async function getFileUrl(key: string | null): Promise<string | null> {
  if (!key) return null;
  const port = S3_ENDPOINT_PORT ? `:${S3_ENDPOINT_PORT}` : '';
  const protocol = S3_USE_SSL === 'true' ? 'https' : 'http';
  return `${protocol}://${S3_ENDPOINT_HOST}${port}/${S3_BUCKET_NAME}/${key}`;
}

// Initialize the bucket when the module loads
ensureBucket().catch(console.error);
