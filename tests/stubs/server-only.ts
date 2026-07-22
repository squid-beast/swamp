// Empty stub so `import "server-only"` resolves under vitest.
//
// `server-only` is a Next.js guard that throws if a module is pulled into a
// client bundle. It has no runtime behaviour worth testing, and it is not
// resolvable outside the Next build, so unit tests alias it here (see
// vitest.config.mts) to exercise the pure exports of server-only modules.
export {};
