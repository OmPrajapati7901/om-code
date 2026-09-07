/** LRN-13: the shared driver contract, run against the local-ts driver. */
import { createLocalDriver } from "@om-code/stub-client";
import { driverContract } from "./contract/driver.js";

driverContract("local-ts", (root) => Promise.resolve({ client: createLocalDriver({ root }) }));
