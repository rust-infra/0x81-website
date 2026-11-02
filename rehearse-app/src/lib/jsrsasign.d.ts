declare module 'jsrsasign' {
  export const KJUR: {
    jws: {
      JWS: {
        sign: (algorithm: string, header: string, payload: string, key: string) => string;
      };
    };
  };
}
