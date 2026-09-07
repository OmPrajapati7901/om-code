import type { Tool } from "../tool.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";
import { createReadTool } from "./read.js";

export { createGlobTool, globInputSchema } from "./glob.js";
export { createGrepTool, grepInputSchema } from "./grep.js";
export {
  createReadTool,
  READ_REFUSAL_PREFIX,
  type ReadRefusal,
  readInputSchema,
} from "./read.js";

export function readOnlyTools(): readonly Tool[] {
  return [createReadTool(), createGrepTool(), createGlobTool()];
}
