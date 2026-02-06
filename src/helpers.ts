export type RandomSource = {
  fillBytes: (bytes: Uint8Array) => void;
};

export function now(): number {
  return Math.floor(Date.now());
}

export function random_id(length: number, alphabet: string, source?: RandomSource): string {
  const bytes = new Uint8Array(length);
  if (source) {
    source.fillBytes(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}
