// An internal object identity, never derived from a request or environment
// variable. The production HTTP entry point does not supply this capability.
export const syntheticQueueCapability = Symbol('isolated synthetic queue capability');
