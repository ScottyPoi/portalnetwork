var twoify = function (n: number) {
    if (n && !(n & (n - 1))) return n
    var p = 1
    while (p < n) p <<= 1
    return p
  }
  
  export class CyclicList {
      size: number;
      mask: number;
      values: Array<unknown>;
    constructor(size: number) {
    this.size = twoify(size)
    this.mask = this.size - 1
    this.values = new Array(size)
  }
  put(index: number, val: number) {
      var pos = index & this.mask
      this.values[pos] = val
      return pos
    }
    get(index: number) {
        return this.values[index & this.mask]
      }
      del(index: number) {
          var pos = index & this.mask
          var val = this.values[pos]
          this.values[pos] = undefined
          return val
        }
  
  
}  