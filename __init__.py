"""gbooks-harvest: reproducible bibliographic harvesting from the Google Books API."""

from .core import HarvestConfig, harvest, flatten, parse_year

__all__ = ["HarvestConfig", "harvest", "flatten", "parse_year"]
__version__ = "0.1.0"
