export const isServerlessRuntime = () => {
  return (
    !!process.env.VERCEL ||
    !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
    !!process.env.LAMBDA_TASK_ROOT ||
    (process.env.AWS_EXECUTION_ENV ?? '').toLowerCase().includes('lambda')
  );
};

export const shouldRunStartupTasks = () => !isServerlessRuntime();