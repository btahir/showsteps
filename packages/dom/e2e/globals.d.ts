declare const ShowstepsDom: typeof import("../src");
interface Window {
  __ssRecord?: (payload: unknown) => Promise<void>;
}
