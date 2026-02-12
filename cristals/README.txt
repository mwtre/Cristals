Add your crystal images here (jpg, png, webp).
Then in index.html, find the crystalImages array and add the filenames, e.g.:
  var crystalImages = ['my-crystal.jpg', 'another.png'];

TEXT POSITION AND BOX (mapping the incision area):
- Use "Map text positions" to set where each line goes. Then use "Engraving box size"
  (Width % and Height %) so the dashed box matches the real incision area on the
  crystal. Download mapping.json and save it here.
- mapping.json can include per line: x, y, boxW, boxH, align, slant; and per image: font
  ('DM Serif Display', 'Playfair Display', 'Cormorant Garamond', 'Cinzel', 'Georgia').
