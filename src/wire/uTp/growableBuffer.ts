type Option<T> = {
  has: boolean;
  value?: T;
};

function some<T>(value: T): Option<T> {
  return { has: true, value: value };
}

function _get<T>(option: Option<T>): T {
  return option.value as T;
}

function none<T>(kind?: TypedPropertyDescriptor<T>): Option<T> {
  return { has: false };
}

function isSome<T>(option: Option<T>): boolean {
  return option.has;
}

function isNone<T>(option: Option<T>): boolean {
  return !option.has;
}

function either<T>(option: Option<T>, otherwise: T): T {
  return option.has && option.value ? option.value : otherwise;
}

function unsafeGet<T>(option: Option<T>): T {
  return option.value as T;
}

export function bitLength(n: number): number {
  const bitstring = n.toString(2);
  if (bitstring === "0") {
    return 0;
  }
  return bitstring.length;
}

export function nextPowerOf2(n: number): number {
  return n <= 0 ? 1 : Math.pow(2, bitLength(n - 1));
}

export type GrowableCircularBuffer<A> = {
  items: Option<A>[];
  mask: number;
};

export function init<A>(
  T: GrowableCircularBuffer<A>,
  size: number = 16
): typeof T {
  let powOfTwoSize = nextPowerOf2(size);
  let gcb: GrowableCircularBuffer<A> = {
    items: new Array<Option<A>>(size),
    mask: powOfTwoSize - 1,
  };
  return gcb;
}

export function get<A>(buff: GrowableCircularBuffer<A>, i: number): Option<A> {
  return buff.items[i & buff.mask];
}

export function putImpl<A>(
  buff: GrowableCircularBuffer<A>,
  i: number,
  elem: Option<A>
): void {
  buff.items[i & buff.mask] = elem;
}

export function put<A>(
  buff: GrowableCircularBuffer<A>,
  i: number,
  elem: A
): void {
  putImpl(buff, i, some(elem));
}

export function _delete<A>(buff: GrowableCircularBuffer<A>, i: number): void {
  putImpl(buff, i, none<A>());
}

export function hasKey<A>(buff: GrowableCircularBuffer<A>, i: number): boolean {
  return isSome(get(buff, i));
}

export function exists<A>(
  buff: GrowableCircularBuffer<A>,
  i: number,
  check: { (x: A): boolean }
): boolean {
  let maybeElem = get(buff, i);
  if (isSome(maybeElem)) {
    let elem = unsafeGet(maybeElem);
    return check(elem);
  } else {
    return false;
  }
}

export function contents<A>(buff: GrowableCircularBuffer<A>, i: number): A {
  return _get(buff.items[i & buff.mask]);
}

export function len<A>(buff: GrowableCircularBuffer<A>): number {
  return buff.mask + 1;
}


//   # Increase size until is next power of 2 which consists given index
function getNextSize(currentSize: number, index: number): number {
    var newSize = currentSize;
    while (true) {
        newSize = newSize * 2;
        if (index < newSize) {
            break;
        }
    }
    return newSize;
}

// # Item contains the element we want to make space for
// # index is the index in the list.
export function ensureSize<A>(
  buff: GrowableCircularBuffer<A>,
  item: number,
  index: number
) {

  if (index > buff.mask) {
    let currentSize = buff.mask + 1;
    let newSize = getNextSize(currentSize, index);
    let newMask = newSize - 1;
    var newSeq = new Array<Option<A>>(newSize);
    var i = 0;
    while (i <= buff.mask) {
      let idx = item - index + i;
      newSeq[idx & newMask] = get(buff, idx);
      i++;
    }
    buff.items = newSeq;
    buff.mask = newMask;
  }
}

function* items<A>(buff: GrowableCircularBuffer<A>) {
  for (let e in buff.items) {
    yield e;
  }
}
