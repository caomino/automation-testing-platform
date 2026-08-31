import { PipelineOrchestrator } from './packages/orchestrator/dist/index.js';
import { InMemoryArtifactStore } from './packages/infra-store/dist/index.js';
import { ConsoleLogger } from './packages/infra-logger/dist/index.js';
import { createEngine } from './packages/engine-mcp/dist/index.js';

console.log('Testing full pipeline script');
