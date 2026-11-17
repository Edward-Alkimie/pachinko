"""Custom user model.

Declared before the first migration so fields can be added later without swapping the
user model mid-project (e.g. a Sui wallet address, once the Sui integration starts).
"""
from django.contrib.auth.models import AbstractUser


class User(AbstractUser):
    """Username + hashed password account (Django's built-in auth fields)."""
