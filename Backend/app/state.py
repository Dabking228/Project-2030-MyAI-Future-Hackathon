from dataclasses import dataclass, field
from typing import Dict

import networkx as nx
import pandas as pd

@dataclass
class AppState:
    is_ready: bool = False
    graph: nx.MultiDiGraph = field(default_factory=nx.MultiDiGraph)
    stops: pd.DataFrame = field(default_factory=pd.DataFrame)
    routes: pd.DataFrame = field(default_factory=pd.DataFrame)
    trips: pd.DataFrame = field(default_factory=pd.DataFrame)
    stop_times: pd.DataFrame = field(default_factory=pd.DataFrame)
    fare_rules: Dict = field(default_factory=dict)
