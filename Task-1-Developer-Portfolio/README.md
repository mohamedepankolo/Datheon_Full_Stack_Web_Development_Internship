# Mohamede Pankolo | Personal Portfolio

A responsive English-language personal portfolio showcasing software engineering, applied AI, data engineering and leadership. Starts in dark mode on each page load, with a floating Light/Dark switch.

## Run
Open `index.html` or run a local static server: `python -m http.server 8000`. No build step required.

## Pages
- About: profile, services, actual LinkedIn recommendations, organisations
- Resume: education, work, leadership and community experience, selected recognition and skills
- Portfolio: illustrated project and experience cards with filters
- Insights: topical experience notes (not represented as published blog posts)
- Contact: map and mailto form

## Editorial notes
Project visuals are generated conceptual illustrations, **not screenshots** of existing software. LinkedIn recommendations are attributed to their original authors and publicly visible text. Dates are taken from the provided CVs, which may be more recent than the public profile. GitHub project-specific repositories were not available and therefore are not invented. The contact form uses the visitor's local email application, not a backend. Skill percentages from an earlier version were removed because they were subjective.

## Credits
This portfolio is adapted from the vCard personal portfolio template; see LICENSE. The layout, CSS architecture and navigation remain derived from the original.

## Final adjustments
- Real passport portrait, with only pink shirt recoloured ochre. Original portrait preserved in source upload.
- Circular recommendation avatars without actual LinkedIn profile photos, to avoid unverified identity images.
- Project cards open accessible detail dialogs, and blog items open six separate English articles.
- Dark is the default for first-time visitors. Theme selection persists locally.
- Conceptual project illustrations are not product screenshots.
- Test locally using a basic server: `python -m http.server 8000` and visit `http://localhost:8000`.

## Final polish
- Compact LinkedIn testimonial previews; click opens full quote.
- Dr Charles Nwishienyi portrait references a publicly published image (falls back to initials offline). Joyce retains a neutral initials avatar pending a reliable portrait.
- Dark-mode portrait on charcoal background; original light-background portrait in light mode.
- Article navigation uses one understated Back link.
