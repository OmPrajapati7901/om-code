import { adapterFor } from "./contract/adapter-fixtures.js";
import { providerContract } from "./contract/provider.js";

providerContract("OpenAI-compatible adapter", adapterFor);
