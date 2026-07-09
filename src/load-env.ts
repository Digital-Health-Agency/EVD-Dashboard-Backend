import { config } from 'dotenv';
import { resolve } from 'path';

// Load before modules that read process.env at import time (e.g. auth.ts).
config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });
