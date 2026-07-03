/**
 * Creates a registry for late-bound bootstrap coordinators.
 * @param {Record<string, Function>} [initialEntries={}] - Optional initial callbacks.
 * @returns {{set: function(string, Function=): void, invoke: function(string, ...unknown): unknown, getInvoker: function(string): Function}} Registry API.
 */
export function createBootstrapCoordinatorRegistry(initialEntries = {}) {
  const callbacks = new Map();

  for (const [name, callback] of Object.entries(initialEntries)) {
    callbacks.set(name, typeof callback === 'function' ? callback : () => {});
  }

  return {
    /**
     * Stores or replaces a named callback.
     * @param {string} name - Callback name.
     * @param {Function} [callback] - Callback implementation.
     */
    set(name, callback = () => {}) {
      callbacks.set(name, typeof callback === 'function' ? callback : () => {});
    },

    /**
     * Invokes a named callback.
     * @param {string} name - Callback name.
     * @param {...unknown} args - Invocation arguments.
     * @returns {unknown} Callback result.
     */
    invoke(name, ...args) {
      return (callbacks.get(name) || (() => {}))(...args);
    },

    /**
     * Returns a stable invoker for a named callback.
     * @param {string} name - Callback name.
     * @returns {Function} Stable invoker.
     */
    getInvoker(name) {
      return (...args) => this.invoke(name, ...args);
    },
  };
}
