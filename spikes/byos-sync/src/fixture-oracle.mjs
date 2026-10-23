import { canonical } from "./oracle.mjs";
export function matchesFixture(replicas, expected) {
  return replicas.every((pages) => canonical(pages) === canonical(expected));
}
