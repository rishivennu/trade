// Vercel serverless entry — re-exports the Express app.
// vercel.json rewrites /api/* to this function; Express matches the original path.
import app from "../server/index.js";
export default app;
