import { createStore } from './packages/infra-store/src/index.js';
const store = createStore();
store.listProjects().then(console.log);
