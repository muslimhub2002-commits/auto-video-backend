import { v2 as cloudinary } from 'cloudinary';
import { withTimeout } from './promise.utils';

export const ensureCloudinaryConfigured = () => {
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_CLOUD_SECRET
  ) {
    throw new Error('Cloudinary environment variables are not configured');
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_CLOUD_SECRET,
  });
};

export const uploadBufferToCloudinary = async (params: {
  buffer: Buffer;
  folder: string;
  resource_type: 'image' | 'video';
}): Promise<{ secure_url: string; public_id: string }> => {
  ensureCloudinaryConfigured();

  const uploadPromise = new Promise<any>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: params.folder,
        resource_type: params.resource_type,
        overwrite: false,
        use_filename: false,
      },
      (error, result) => {
        if (error || !result) {
          return reject(error ?? new Error('Cloudinary upload failed'));
        }
        resolve(result);
      },
    );

    stream.end(params.buffer);
  });

  const uploadResult: any = await withTimeout(
    uploadPromise,
    params.resource_type === 'image' ? 60_000 : 90_000,
    `Cloudinary ${params.resource_type} upload`,
  );

  if (!uploadResult?.secure_url || !uploadResult?.public_id) {
    throw new Error('Cloudinary upload did not return a secure_url');
  }

  return {
    secure_url: uploadResult.secure_url as string,
    public_id: uploadResult.public_id as string,
  };
};

export const uploadVideoFileToCloudinary = async (params: {
  filePath: string;
  folder: string;
  timeoutMs: number;
}) => {
  ensureCloudinaryConfigured();
  const uploadResult: any = await withTimeout(
    cloudinary.uploader.upload(params.filePath, {
      folder: params.folder,
      resource_type: 'video',
      overwrite: false,
      use_filename: false,
    }),
    params.timeoutMs,
    'Cloudinary final video upload',
  );

  if (!uploadResult?.secure_url) {
    throw new Error('Cloudinary video upload did not return a secure_url');
  }

  return uploadResult.secure_url as string;
};
