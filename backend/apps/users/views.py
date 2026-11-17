"""Accounts API: csrf, register, login, logout, me. Session-cookie auth."""
from django.contrib.auth import authenticate, login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .serializers import LoginSerializer, RegisterSerializer, UserSerializer

INVALID_LOGIN = {"detail": "Invalid username or password."}


@method_decorator(ensure_csrf_cookie, name="get")
class CsrfView(APIView):
    """GET sets the `csrftoken` cookie; send it back as the X-CSRFToken header on POST/PUT."""

    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        return Response({"detail": "CSRF cookie set."})


class AnonymousAuthView(APIView):
    """Base for register/login: open to anonymous users, CSRF-checked, rate-limited.

    DRF only checks CSRF for already-logged-in sessions, so csrf_protect is added
    explicitly to block login-CSRF from other sites.
    """

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @method_decorator(csrf_protect)
    def dispatch(self, request, *args, **kwargs):
        return super().dispatch(request, *args, **kwargs)


class RegisterView(AnonymousAuthView):
    def post(self, request: Request) -> Response:
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        login(request, user)
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class LoginView(AnonymousAuthView):
    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(request, **serializer.validated_data)
        if user is None:  # wrong password, unknown user, or inactive: same answer
            return Response(INVALID_LOGIN, status=status.HTTP_400_BAD_REQUEST)
        login(request, user)
        return Response(UserSerializer(user).data)


class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request: Request) -> Response:
        return Response(UserSerializer(request.user).data)
