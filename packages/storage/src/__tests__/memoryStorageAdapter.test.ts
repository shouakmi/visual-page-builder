import { createMemoryStorageAdapter } from '../memoryStorageAdapter.ts';
import { runStorageAdapterContractTests } from '../storageAdapter.contract.ts';

runStorageAdapterContractTests('memoryStorageAdapter', () => createMemoryStorageAdapter());
