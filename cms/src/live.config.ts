// EmDash's content, as an Astro live collection. kith-cms renders no pages of
// its own, but EmDash's runtime expects the collection to be declared.
import { defineLiveCollection } from "astro:content";
import { emdashLoader } from "emdash/runtime";

export const collections = {
  _emdash: defineLiveCollection({ loader: emdashLoader() }),
};
