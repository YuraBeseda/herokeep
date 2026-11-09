/**
 * The CDK overlay container: dialog specs query inside it, never the shared document, so a dialog
 * left open by another spec cannot answer the query.
 */
export const overlayRoot = (): ParentNode =>
  document.querySelector('.cdk-overlay-container') ?? document;
