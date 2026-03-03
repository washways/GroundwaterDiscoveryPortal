# Contributing to the Groundwater Discovery Portal

Thank you for your interest in contributing! This project aims to improve groundwater exploration in data-scarce regions using remote sensing and open datasets.

## How to Contribute

### Reporting Issues
- Use [GitHub Issues](../../issues) to report bugs or request features
- Include your GEE environment details and the zoom level / region you were viewing
- Screenshots of unexpected results are very helpful

### Suggesting Improvements
- **New data layers**: Propose additional datasets that could improve the index (e.g., geophysical surveys, local geological maps)
- **Weight calibration**: If you have borehole yield data for a region, we welcome calibration studies
- **Regional adaptation**: Help adapt the dry-season NDVI month, weight defaults, or constraint thresholds for new countries

### Code Contributions
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-improvement`)
3. Make your changes to the GEE script in `gee/`
4. Test in the [GEE Code Editor](https://code.earthengine.google.com/)
5. Update documentation if your change affects methodology or parameters
6. Submit a Pull Request with a clear description of what changed and why

### Documentation
- Improvements to the README, methodology docs, or dataset references are always welcome
- If you find broken links or outdated information, please open an issue or PR

## Code Style
- Use clear variable names (e.g., `fracturesN` not `fN`)
- Comment non-obvious computations
- Keep the pillar structure (Storage / Supply / Yield / Constraint) consistent

## Code of Conduct
This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Please be respectful and constructive in all interactions.

## Questions?
Open a [Discussion](../../discussions) or contact the WASHways team.
