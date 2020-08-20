import React, { useCallback, useEffect, useRef } from "react";
import debounce from "lodash-es/debounce";

interface ItemMeasureChildrenProps {
  measureRef: React.Ref<HTMLDivElement>;
}

const RESIZE_DEBOUNCE_MS = 100;

interface ItemMeasureProps {
  index: number;
  onResize: (index: number, contentRect: DOMRectReadOnly) => void;
  children: ({ measureRef }: ItemMeasureChildrenProps) => React.ReactElement;
}

export const ItemMeasure = React.memo<ItemMeasureProps>(function ({
  onResize,
  children,
  index,
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const onResizeCallback = useCallback<ResizeObserverCallback>(
    debounce((entries) => {
      for (let entry of entries) {
        onResize(index, entry.contentRect);
      }
    }, RESIZE_DEBOUNCE_MS),
    [onResize, index]
  );

  useEffect(() => {
    observer.current = new ResizeObserver(onResizeCallback);
    if (measureRef.current) {
      observer.current.observe(measureRef.current);
    }

    return () => {
      if (observer.current) {
        observer.current.disconnect();
      }
    };
  }, [observer, onResizeCallback, measureRef]);

  return children({ measureRef });
});
