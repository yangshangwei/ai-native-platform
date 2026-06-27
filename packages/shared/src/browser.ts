/**
 * Browser-safe entry point for @ainp/shared.
 * Excludes Node.js-specific modules like platform utilities.
 */

export * from './types/ids';
export * from './types/project';
export * from './types/workflow';
export * from './types/artifact';
export * from './types/knowledge-entity';
export * from './types/dual-write';
export * from './types/command';
export * from './types/gate';
export * from './types/build';
export * from './types/agent';
export * from './types/agent-session';
export * from './types/tool-invocation';
export * from './types/step-checkpoint';
export * from './types/agent-event';
export * from './types/context';
export * from './types/execution-environment';
export * from './types/skill';
export * from './types/coordinator';
export * from './types/request-message';
export * from './types/router';

export * from './flows/registry';

export * from './coordinator';

export * from './utils/id';
export * from './utils/error';
export * from './utils/whitelist';
export * from './utils/surefire';
export * from './utils/redaction';
export * from './utils/agent-backend-cli';
export * from './utils/agent-backend-preflight';
export * from './utils/context-policy';
// platform 模块仅在服务器端可用

export * from './config/registry';
export * from './config/defaults';
export * from './config/template';
