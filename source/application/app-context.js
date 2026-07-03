/**
 * Creates the application context shared by bootstrap, UI bindings, and
 * integration adapters.
 * @param {object} options - Context options.
 * @param {object} [options.runtime] - Legacy runtime object graph.
 * @param {object} [options.ports] - Use-case specific port bundle.
 * @param {object} options.commands - Application command callbacks.
 * @returns {object} Application context.
 */
export function createApplicationContext(options) {
  const ports = options?.ports ?? {};
  return {
    ports,
    runtime: options?.runtime ?? ports.viewer ?? {},
    commands: options?.commands ?? {},
  };
}
