"""Request/response shapes for the accounts API. Passwords are write-only."""
from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework import serializers

from .models import User


class UserSerializer(serializers.ModelSerializer):
    """Public view of an account: never includes the password hash."""

    class Meta:
        model = User
        fields = ["id", "username"]
        read_only_fields = fields


USERNAME_TAKEN = "A user with that username already exists."


class RegisterSerializer(serializers.ModelSerializer):
    # Declared explicitly so the uniqueness check runs on the *normalized* name
    # (Django NFKC-normalizes usernames on save: "ｋevin" == "kevin").
    username = serializers.CharField(max_length=150, validators=[User.username_validator])
    password = serializers.CharField(write_only=True, trim_whitespace=False, max_length=128)

    class Meta:
        model = User
        fields = ["username", "password"]

    def validate_username(self, value: str) -> str:
        username = User.normalize_username(value)
        if User.objects.filter(username=username).exists():
            raise serializers.ValidationError(USERNAME_TAKEN)
        return username

    def validate(self, attrs: dict) -> dict:
        candidate = User(username=attrs["username"])
        try:
            password_validation.validate_password(attrs["password"], candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)}) from exc
        return attrs

    def create(self, validated_data: dict) -> User:
        try:
            with transaction.atomic():
                return User.objects.create_user(**validated_data)
        except IntegrityError as exc:  # two requests registered the same name at once
            raise serializers.ValidationError({"username": [USERNAME_TAKEN]}) from exc


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, trim_whitespace=False, max_length=128)

    def validate_username(self, value: str) -> str:
        return User.normalize_username(value)
