# Ingenium brand artwork

`ingenium-logo.png` preserves the original supplied artwork for reference. The live UI now uses native SVG in `src/Brand.tsx`: four purple geometric paths and a bold serif Ingenium wordmark. It has a transparent background and contains no cropped tagline, raster image, white-removal filter or white outline. The wordmark uses Times New Roman with Times/Liberation Serif/serif fallbacks; CSS sets deep purple on light surfaces and white on the landing page. The favicon uses the same geometric mark. The letterforms are reconstructed text, not the original bitmap.

`BrandLogo` is used in landing navigation/footer, the platform sidebar and report header. `BrandMark` replaces temporary AI/brand sparkles, wand and lightning icons through the shared Icon component. Search, folder, file, navigation and other functional icons retain their meanings.
