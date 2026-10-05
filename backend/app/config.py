from __future__ import annotations

import os
import urllib.parse
from pathlib import Path

from dotenv import load_dotenv

backend_dir = Path(__file__).resolve().parents[1]
load_dotenv(backend_dir / ".env", override=False)
load_dotenv(override=False)


class Settings:
    def __init__(self) -> None:
        self.app_name = os.getenv("APP_NAME", "BarberShop API")
        self.api_prefix = os.getenv("API_PREFIX", "/api")
        self.cors_origins = os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,https://barber-shop-tst.azurewebsites.net/,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174",
        )

        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            azure_server = os.getenv("AZURE_SQL_SERVER")
            azure_database = os.getenv("AZURE_SQL_DATABASE")
            azure_user = os.getenv("AZURE_SQL_USER")
            azure_password = os.getenv("AZURE_SQL_PASSWORD")
            azure_driver = os.getenv("AZURE_SQL_DRIVER", "ODBC Driver 18 for SQL Server")

            if not (azure_server and azure_database and azure_user and azure_password):
                raise ValueError("Faltan variables AZURE_SQL_* para conectar a Azure SQL (o define DATABASE_URL).")

            odbc_connect = (
                f"DRIVER={{{azure_driver}}};"
                f"SERVER={azure_server};"
                "PORT=1433;"
                f"DATABASE={azure_database};"
                f"UID={azure_user};"
                f"PWD={azure_password};"
                "Encrypt=yes;"
                "TrustServerCertificate=no;"
                "Connection Timeout=30;"
            )
            database_url = f"mssql+pyodbc:///?odbc_connect={urllib.parse.quote_plus(odbc_connect)}"

        self.database_url = database_url
        if self.database_url.startswith("sqlite:///./"):
            db_path = (backend_dir / self.database_url.removeprefix("sqlite:///./")).resolve()
            self.database_url = f"sqlite:///{db_path.as_posix()}"

        if "://" not in self.database_url:
            raise ValueError("DATABASE_URL inválido. Debe ser un URL SQLAlchemy.")

        self.db_auto_create = os.getenv("DB_AUTO_CREATE", "1") == "1"

        self.jwt_secret = os.getenv("JWT_SECRET", "dev-secret-change-me")
        self.jwt_access_minutes = int(os.getenv("JWT_ACCESS_MINUTES", "60"))
        self.seed_admin_email = os.getenv("SEED_ADMIN_EMAIL", "admin@barbershop.local")
        self.seed_admin_password = os.getenv("SEED_ADMIN_PASSWORD", "admin12345")

        self.smtp_enabled = os.getenv("SMTP_ENABLED", "0") == "1"
        self.smtp_host = (os.getenv("SMTP_HOST") or "").strip() or None
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.smtp_user = (os.getenv("SMTP_USER") or "").strip() or None
        self.smtp_password = (os.getenv("SMTP_PASSWORD") or "").strip() or None
        self.smtp_from = (os.getenv("SMTP_FROM") or "").strip() or None
        self.smtp_starttls = os.getenv("SMTP_STARTTLS", "1") == "1"
        self.smtp_ssl = os.getenv("SMTP_SSL", "0") == "1"

        env_dev_code = (os.getenv("BOOKING_DEV_CODE") or "").strip() or None
        self.booking_dev_code = env_dev_code or ("111111" if (not self.smtp_enabled and self.database_url.startswith("sqlite")) else None)

        self.firebase_service_account_json = (os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON") or "").strip() or None
        self.firebase_service_account_path = (os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH") or "").strip() or None


settings = Settings()
