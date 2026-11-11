import fontUrl from "../assets/fonts/NotoSans-Regular.ttf?url";
import boldUrl from "pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf?url";

let pending: Promise<[Uint8Array, Uint8Array]> | undefined;
export function loadCustomerDocumentFonts(): Promise<[Uint8Array, Uint8Array]> {
  pending ??= Promise.all(
    [fontUrl, boldUrl].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error("The PDF fonts could not be loaded. Try again.");
      return new Uint8Array(await response.arrayBuffer());
    }),
  )
    .then((fonts) => fonts as [Uint8Array, Uint8Array])
    .catch((error) => {
      pending = undefined;
      throw error;
    });
  return pending;
}
