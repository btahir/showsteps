declare const StepsnapDom: typeof import("../src");
interface Window {
  __ssRecord?: (payload: unknown) => Promise<void>;
}
