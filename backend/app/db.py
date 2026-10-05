from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    pass


def _create_engine():
    connect_args = {}
    engine_kwargs = {}
    if settings.database_url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
    if settings.database_url.startswith("mssql+pyodbc"):
        engine_kwargs["fast_executemany"] = True
    return create_engine(settings.database_url, future=True, pool_pre_ping=True, connect_args=connect_args, **engine_kwargs)


engine = _create_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

