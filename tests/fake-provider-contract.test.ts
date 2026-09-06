import { fakeFor } from "./contract/fake-fixtures.js";
import { providerContract } from "./contract/provider.js";

providerContract("fake provider", fakeFor);
