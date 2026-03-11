#!/bin/bash

# Wait for MinIO to be ready
until mc alias set myminio http://minio:9000 tgarchive_dev tgarchive_dev_password; do
  echo "Waiting for MinIO to be ready..."
  sleep 1
done

# Create bucket if it doesn't exist
mc mb myminio/tg-archive || true

# Set bucket policy to public (optional, depending on your needs)
# mc policy set public myminio/tg-archive
