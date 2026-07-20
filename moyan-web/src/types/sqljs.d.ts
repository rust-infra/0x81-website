declare module 'sql.js' {
  interface QueryResults {
    columns: string[];
    values: any[][];
  }

  interface ParamsObject {
    [key: string]: any;
  }

  interface ParamsArray {
    [index: number]: any;
  }

  type SqlJsConfig = {
    locateFile?: (file: string) => string;
  };

  class Database {
    constructor(data?: Uint8Array);
    run(sql: string, params?: ParamsObject | ParamsArray): Database;
    exec(sql: string): QueryResults[];
    each(sql: string, params: ParamsObject | ParamsArray, callback: (obj: ParamsObject) => void): Database;
    prepare(sql: string, params?: ParamsObject | ParamsArray): Statement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
    create_function(name: string, func: (...args: any[]) => any): void;
  }

  class Statement {
    bind(values?: ParamsObject | ParamsArray): boolean;
    step(): boolean;
    get(params?: ParamsObject | ParamsArray): any;
    getColumnNames(): string[];
    getAsObject(params?: ParamsObject | ParamsArray): ParamsObject;
    getSQL(): string;
    free(): boolean;
  }

  interface SqlJsStatic {
    Database: typeof Database;
    Statement: typeof Statement;
  }

  function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;

  export default initSqlJs;
  export { Database, Statement };
}
