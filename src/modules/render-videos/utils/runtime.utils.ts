export const isCloudinaryUrl = (url: string): boolean => {
  return /^(https?:\/\/)?res\.cloudinary\.com\//i.test(url || '');
};

export const isServerlessRuntime = () => {
  return (
    !!process.env.VERCEL ||
    !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
    !!process.env.LAMBDA_TASK_ROOT ||
    (process.env.AWS_EXECUTION_ENV ?? '').toLowerCase().includes('lambda')
  );
};
