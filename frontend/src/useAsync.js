import { useCallback, useEffect, useRef, useState } from "react";

export function useAsync(loader, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const ctrl = useRef(null);
  const [nonce, setNonce] = useState(0);

  const run = useCallback(() => {
    ctrl.current?.abort();
    const controller = new AbortController();
    ctrl.current = controller;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (controller.signal.aborted || error.name === "AbortError") return;
        setState((s) => ({ data: s.data, error, loading: false }));
      });
  }, deps);

  useEffect(() => {
    run();
    return () => ctrl.current?.abort();
  }, [run, nonce]);

  return { ...state, retry: () => setNonce((n) => n + 1) };
}

export default useAsync;
