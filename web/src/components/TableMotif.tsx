/**
 * With no hero image, the art is the Kith logo itself, at room scale on the
 * right. With one, the organiser's picture is the art and this stays out.
 */
export function TableMotif() {
  return <img className="logo-art" src="/mark.svg" alt="" aria-hidden="true" />;
}
