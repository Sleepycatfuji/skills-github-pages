# Beyond Work photograph

`tokyo-dog-walking.webp` is Kim's personal dog-walking photograph, supplied for this
portfolio update. It was selected from `IMG_7459.HEIC` because it shows the dog
outdoors and contains no visible human face. The photo showing a woman's face is
not included in the website or its repository.

The selected photo was converted to a 1200 × 1600 WebP for the web, with metadata
removed. No subjects were generated or altered. The card uses CSS to frame the
dog's head and harness; the full image remains a dog-only photograph.

To replace it later:

1. Put an optimized version of your new photo in this folder. Keep the original
   separately, outside the website repository.
2. Find `<!-- Personal dog-walking photo` in `index.html`, `da.html`, `th.html`,
   and `ja.html`. Update the image filename, real pixel dimensions, and alt text
   in each page. Describe what is actually visible and translate the alt text
   for each language. Do not assume Kim is pictured unless she is visible.
3. Adjust `.volunteer-photo`'s `object-position` in `assets/css/beyond-work.css` if
   the displayed crop needs to move. Choose a photo without visible human faces,
   or remove faces from the actual image file before publishing it; CSS cropping
   alone does not keep a face out of the downloadable original.

The Thailand card uses a decorative inline book-and-heart illustration. It does
not depict an actual volunteering visit and needs no third-party attribution.
