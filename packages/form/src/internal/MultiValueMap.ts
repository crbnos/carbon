import { useCallback, useRef } from "react";

export class MultiValueMap<Key, Value> {
  private dict: Map<Key, Value[]> = new Map();

  add = (key: Key, value: Value) => {
    if (this.dict.has(key)) {
      this.dict.get(key)!.push(value);
    } else {
      this.dict.set(key, [value]);
    }
  };

  delete = (key: Key) => {
    this.dict.delete(key);
  };

  remove = (key: Key, value: Value) => {
    if (!this.dict.has(key)) return;
    const array = this.dict.get(key)!;
    const index = array.indexOf(value);
    if (index !== -1) array.splice(index, 1);
    if (array.length === 0) this.dict.delete(key);
  };

  getAll = (key: Key): Value[] => {
    return this.dict.get(key) ?? [];
  };

  entries = (): IterableIterator<[Key, Value[]]> => this.dict.entries();

  values = (): IterableIterator<Value[]> => this.dict.values();

  has = (key: Key): boolean => this.dict.has(key);
}

export const useMultiValueMap = <Key, Value>() => {
  const ref = useRef<MultiValueMap<Key, Value> | null>(null);
  return useCallback(() => {
    if (ref.current) return ref.current;
    ref.current = new MultiValueMap();
    return ref.current;
  }, []);
};
