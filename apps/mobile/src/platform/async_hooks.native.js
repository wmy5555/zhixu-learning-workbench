// NOT a general AsyncLocalStorage polyfill. The mobile gateway serializes every
// service operation (including background ticks) until its whole promise settles.
// Research may parallelize children within an unchanged scope, never sibling scopes.
export class AsyncLocalStorage {
  current = undefined;
  getStore() { return this.current; }
  async run(value, fn) { const previous=this.current;this.current=value;try{return await fn();}finally{this.current=previous;} }
}
export default { AsyncLocalStorage };
