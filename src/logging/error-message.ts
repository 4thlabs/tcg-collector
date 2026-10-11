// Text of an error caught as `unknown`: anything can be thrown in JavaScript, not only an Error.

export class ErrorMessage {
  static of(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
