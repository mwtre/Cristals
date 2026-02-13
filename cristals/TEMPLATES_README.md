# How to edit templates

Edit **templates.json** in this folder to change the Graphic templates customers see.

## Structure

- **templates**: array of template objects. Order = order on screen.

## Each template object

| Field         | Required | Description |
|---------------|----------|-------------|
| **name**      | Yes      | Title shown on the card (e.g. "Classic Award") |
| **description** | Yes    | Short text under the title (e.g. "Awarded to [Name]...") |
| **price**     | Yes      | `0` = Free, or number (e.g. `8` = $8) |
| **line1**     | Yes      | Text for Line 1 on the crystal |
| **line2**     | Yes      | Text for Line 2 (can be `""`) |
| **line3**     | Yes      | Text for Line 3 (can be `""`) |
| **arts**      | Yes      | Array of decorations. Use `[]` for none. |
| **positions** | No       | Optional. If omitted, default positions are used. |

## Arts (decorations)

Each item in **arts** can have:

- **type**: `"line"` | `"doubleLine"` | `"star"` | `"diamond"` | `"dot"` | `"dashes"`
- **x**, **y**: center position, 0–1 (e.g. 0.5 = middle)
- **width**: for line/doubleLine/dashes, width as fraction of image (e.g. 0.5)
- **size**: thickness/size (e.g. 0.02–0.07)
- **color**: `"white"` | `"blue"` | `"black"`

Example: a horizontal double line between line1 and line2:

```json
{ "type": "doubleLine", "x": 0.5, "y": 0.45, "width": 0.55, "size": 0.025, "color": "white" }
```

## Positions

Optional. Each of **line1**, **line2**, **line3** can have **x** and **y** (0–1). Example:

```json
"positions": {
  "line1": { "x": 0.5, "y": 0.38 },
  "line2": { "x": 0.5, "y": 0.52 },
  "line3": { "x": 0.5, "y": 0.66 }
}
```

Save the file and refresh the app to see changes.
